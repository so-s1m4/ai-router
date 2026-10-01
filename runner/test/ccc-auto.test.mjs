import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, copyFile } from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { prepareSolverTemplate } from '../dist/ccc-solver-template.js';
import path from 'node:path';
import { runCccAuto, contestReference, readAnswers, solverContext } from '../dist/ccc-auto.js';
import { recoveringCcc, toolData } from '../dist/ccc-client.js';

const job = { taskId:'task', jobId:'job', sessionId:'session', accountId:'account', provider:'codex', model:'ignored', mode:'task', workflow:'ccc-auto', prompt:'https://codingcontest.org/contests/training-example/game' };
async function fixture(action, options = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-auto-'));
  const controller = new AbortController();
  const calls = [], events = [], solverJobs = [];
  const passed = {};
  const originalFetch = globalThis.fetch;
  const originalFastLevels = process.env.CCC_AUTO_FAST_LEVELS;
  if (options.defaultFastLevels) delete process.env.CCC_AUTO_FAST_LEVELS;
  else process.env.CCC_AUTO_FAST_LEVELS = String(options.fastLevels ?? 0);
  const levels = options.levels ?? [1,2];
  globalThis.fetch = async () => new Response('1\nexample\n');
  const info = () => ({ contest_slug:'training-example', game:{name:'Example'}, levels:levels.map(level=>({level, inputFiles:['0-example','1-small','2-large'],unscoredFiles:['0-example']})), participant:{score:{state:Object.fromEntries(levels.map(level=>['level'+level,{passedFiles:{...passed[level]}}]))}} });
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
        const submissionCount = calls.filter(call=>call.name==='submit_solution').length;
        const correct = (!options.reject || previous > 1) && (!options.rejectFirst || submissionCount > 1)
          && submissionCount !== options.rejectAt;
        if (correct) (passed[args.level] ||= {})[args.file_id] = 12345;
        if (options.recovered && args.level === 2 && args.file_id === '2-large') throw new Error('Connection lost');
        return {evaluation:{isCorrect:correct},cooldownSec:options.cooldown || 0};
      }
      throw new Error('Unexpected tool: '+name);
    },
  };
  const solve = async (solverJob, signal, emit) => {
    solverJobs.push(solverJob);
    assert.equal(solverJob.model,'gpt-6.1-sol'); assert.ok(solverJob.solverCodeOnly ? solverJob.reasoning === 'low' : ['medium','high'].includes(solverJob.reasoning)); assert.equal(solverJob.fast,true);
    assert.equal(solverJob.solverOnly,true); assert.equal(solverJob.workflow,'standard');
    if (solverJob.solverCodeOnly) {
      emit({type:'usage',data:{inputTokens:10,outputTokens:5,totalTokens:15}});
      return JSON.stringify({source:options.badCode ? 'not C++' : '#include <iostream>\nint main(){std::cout << 42 << std::endl;}',outputMode:options.outputMode ?? 'exact'});
    }
    const output = solverJob.prompt.match(/directly write (\S+) with JSON/)[1];
    const ids = JSON.parse(solverJob.prompt.match(/pending ID: (\[[^\n]+\])/)[1]);
    const answers = ids.map(file_id=>({file_id,solution:'42\n'}));
    if (options.invalid) answers[0].file_id='invented-id';
    if (options.recipe) {
      await writeFile(path.join(path.dirname(output),'solver.json'),JSON.stringify({runtime:'node',script:'solution.cjs'}));
      await writeFile(path.join(path.dirname(output),'solution.cjs'),`require('./batch.cjs').runBatch(()=>'42\\n');`);
    } else await writeFile(output,JSON.stringify({answers}));
    emit({type:'usage',data:{inputTokens:10,outputTokens:5,totalTokens:15}});
    emit({type:'checkpoint',data:{threadId:'solver-thread'}});
    emit({type:'delta',text:'Repeated internal solver summary'});
    return 'Solutions ready';
  };
  try { await action({cwd,controller,client,solve,calls,events,solverJobs,run:(overrides={}, runSignal=controller.signal)=>runCccAuto({...job,...overrides},cwd,client,solve,runSignal,event=>events.push(event))}); }
  finally {globalThis.fetch=originalFetch; if(originalFastLevels === undefined) delete process.env.CCC_AUTO_FAST_LEVELS; else process.env.CCC_AUTO_FAST_LEVELS=originalFastLevels;await rm(cwd,{recursive:true,force:true});}
}

test('CCC script solves levels, submits exact scored IDs and aggregates model usage',async()=>fixture(async f=>{
  const result=await f.run();
  assert.match(result,/Accepted 4 new outputs/);
  assert.equal(f.solverJobs.length,2);
  assert.match(f.solverJobs[0].prompt, /Target solver preparation: about 40 seconds/);
  assert.match(f.solverJobs[0].prompt, /Write all solver algorithms in C\+\+17 from the first attempt/);
  assert.match(f.solverJobs[0].prompt, /g\+\+ -std=c\+\+17 -O2 -pipe solution.cpp -o solution/);
  assert.match(f.solverJobs[0].prompt, /"script":"cpp.cjs"/);
  assert.match(f.solverJobs[0].prompt, /Task context:.*Full statement/);
  assert.match(f.solverJobs[0].prompt, /\\nexample/);
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
test('interrupted solver saves its thread and continuation restores it after restart',async()=>fixture(async f=>{
  let interrupted=true;
  const solve=async(solverJob,signal,emit)=>{
    if(interrupted){
      interrupted=false;
      emit({type:'checkpoint',data:{threadId:'saved-solver-thread'}});
      throw new Error('Stopped');
    }
    assert.equal(solverJob.previousThreadId,'saved-solver-thread');
    return f.solve(solverJob,signal,event=>emit(event.type==='checkpoint'?{...event,data:{threadId:'saved-solver-thread'}}:event));
  };
  await assert.rejects(runCccAuto(job,f.cwd,f.client,solve,f.controller.signal,event=>f.events.push(event)),/Stopped/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,0);
  await runCccAuto({...job,taskId:'continued'},f.cwd,f.client,solve,f.controller.signal,event=>f.events.push(event));
  assert.equal(f.solverJobs.length,2);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
}));
test('account handoff does not restore another account solver thread',async()=>fixture(async f=>{
  const key=createHash('sha256').update('session:training-example').digest('hex').slice(0,24);
  const folder=path.join(f.cwd,'.ai-router/ccc-auto',key);
  await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'state.json'),JSON.stringify({contest:'training-example',submissions:{},solverThread:{accountId:'another-account',threadId:'private-thread'}}));
  await f.run();
  assert.equal(f.solverJobs[0].previousThreadId,undefined);
  assert.equal(f.solverJobs[1].previousThreadId,'solver-thread');
}));
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


test('example checks are requested and stage timings persist with restored-thread metadata', async () => fixture(async f => {
  await f.run();
  assert.match(f.solverJobs[0].prompt, /run the supplied examples locally/);
  assert.doesNotMatch(f.solverJobs[0].prompt, /Do not run local tests|Platform evaluation is the only/);
  const key = createHash('sha256').update('session:training-example').digest('hex').slice(0, 24);
  const records = (await readFile(path.join(f.cwd, '.ai-router/ccc-auto', key, 'timings.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  for (const stage of ['progress', 'download', 'solver', 'execution', 'answer_validation', 'submission', 'total']) {
    assert.ok(records.some(record => record.stage === stage));
  }
  assert.deepEqual(records.filter(r => r.stage === 'solver').map(r => r.reusedThread), [false, true]);
  assert.ok(records.every(r => Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0));
  assert.equal(f.events.filter(e => e.data?.cccTiming).length, records.length);
}, { recipe: true }));

test('solver context supplies examples and bounded headers, marking incomplete previews', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-context-'));
  try {
    const example = path.join(cwd, 'example.txt'), large = path.join(cwd, 'large.txt');
    await writeFile(example, '2\nAB\nCD\n');
    await writeFile(large, '100000\n' + 'X'.repeat(100000));
    const context = await solverContext([
      {name:'in_0-example.txt',path:example},
      {name:'level.pdf',path:'statement.pdf',pdf_preview:{text:'S'.repeat(20000)}},
    ], [{file_id:'1-large',path:large}]);
    assert.equal(context.previews[0].text, '2\nAB\nCD\n');
    assert.equal(context.previews[0].truncated, false);
    assert.equal(context.previews[1].truncated, true);
    assert.ok(context.previews[1].text.startsWith('100000\n'));
    assert.ok(context.previews[1].text.length <= 4096);
    assert.equal(context.files[1].pdf_preview.length, 16000);
    assert.equal(context.files[1].truncated, true);
  } finally { await rm(cwd, {recursive:true,force:true}); }
});

test('batch helper checks one example without writing a scored manifest', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-example-'));
  try {
    await prepareSolverTemplate(cwd);
    await writeFile(path.join(cwd, 'solution.cjs'), "require('./batch.cjs').runBatch(async text => text.toUpperCase());");
    await writeFile(path.join(cwd, 'example.txt'), 'ab\ncd\n');
    const result = spawnSync(process.execPath, ['solution.cjs', '--input', 'example.txt'], {cwd, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'AB\nCD\n');
    await assert.rejects(readFile(path.join(cwd, 'answers.json')), {code:'ENOENT'});
  } finally { await rm(cwd, {recursive:true,force:true}); }
});

test('C++ helper streams examples and scored files through a native executable', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-native-'));
  try {
    await prepareSolverTemplate(cwd);
    // cat exercises the same native stdin/stdout contract without a compiler dependency.
    await copyFile('/bin/cat', path.join(cwd, 'solution'));
    await writeFile(path.join(cwd, 'example.txt'), 'ab\ncd\n');
    const example = spawnSync(process.execPath, ['cpp.cjs', '--input', 'example.txt'], {cwd, encoding:'utf8'});
    assert.equal(example.status, 0, example.stderr);
    assert.equal(example.stdout, 'ab\ncd\n');
    await assert.rejects(readFile(path.join(cwd, 'answers.json')), {code:'ENOENT'});
    const large = 'X'.repeat(2 * 1024 * 1024) + '\n';
    await writeFile(path.join(cwd, 'large.txt'), large);
    await writeFile(path.join(cwd, 'task.json'), JSON.stringify({inputs:[
      {file_id:'small-id',path:path.join(cwd, 'example.txt')},
      {file_id:'large-id',path:path.join(cwd, 'large.txt')},
    ]}));
    const batch = spawnSync(process.execPath, ['cpp.cjs', 'task.json', 'answers.json'], {cwd, encoding:'utf8'});
    assert.equal(batch.status, 0, batch.stderr);
    assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'answers.json'), 'utf8')), {answers:[
      {file_id:'small-id',path:'output-0.txt'}, {file_id:'large-id',path:'output-1.txt'},
    ]});
    assert.equal(await readFile(path.join(cwd, 'output-0.txt'), 'utf8'), 'ab\ncd\n');
    assert.equal(await readFile(path.join(cwd, 'output-1.txt'), 'utf8'), large);
    await rm(path.join(cwd, 'answers.json'));
    await copyFile('/bin/false', path.join(cwd, 'solution'));
    const failed = spawnSync(process.execPath, ['cpp.cjs', 'task.json', 'answers.json'], {cwd, encoding:'utf8'});
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /C\+\+ solver failed/);
    await assert.rejects(readFile(path.join(cwd, 'answers.json')), {code:'ENOENT'});
  } finally { await rm(cwd, {recursive:true,force:true}); }
});


test('early levels generate C++ directly and runner compiles, runs and submits it',async()=>fixture(async f=>{
  assert.match(await f.run(),/Accepted 4 new outputs/);
  assert.deepEqual(f.solverJobs.map(j=>[j.solverCodeOnly,j.reasoning,j.previousThreadId]),[[true,'low',undefined],[true,'low',undefined]]);
  assert.equal(f.events.filter(e=>e.type==='usage').at(-1).data.totalTokens,30);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
  assert.ok(f.events.some(e=>e.data?.cccTiming?.stage==='compile_examples'));
  assert.ok(f.events.some(e=>e.data?.cccTiming?.stage==='code_generation'));
},{fastLevels:2}));

test('fast compiler failure falls back to an agent before any submission',async()=>fixture(async f=>{
  assert.match(await f.run(),/Accepted 4 new outputs/);
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true,false]);
  assert.match(f.solverJobs[1].prompt,/compilation failed/);
  assert.equal(f.events.filter(e=>e.type==='usage').at(-1).data.totalTokens,60);
},{fastLevels:2,badCode:true}));

test('fast rejected outputs are corrected by the agent with platform feedback',async()=>fixture(async f=>{
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true]);
  assert.match(f.solverJobs[1].prompt,/isCorrect/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,5);
  assert.deepEqual(f.calls.filter(c=>c.name==='submit_solution').slice(0,3).map(c=>c.args.file_id),['1-small','1-small','2-large']);
},{fastLevels:2,rejectFirst:true}));

test('default light path continues through all levels until a failure',async()=>fixture(async f=>{
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,true,true,true,true,true,true]);
},{defaultFastLevels:true,levels:[1,2,3,4,5,6,7]}));

test('light rejection preserves accepted inputs and the next level returns to light',async()=>fixture(async f=>{
  assert.match(await f.run(),/Accepted 6 new outputs/);
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,true,false,true]);
  assert.deepEqual(f.calls.filter(c=>c.name==='submit_solution').map(c=>[c.args.level,c.args.file_id]),
    [[1,'1-small'],[1,'2-large'],[2,'1-small'],[2,'2-large'],[2,'2-large'],[3,'1-small'],[3,'2-large']]);
},{defaultFastLevels:true,levels:[1,2,3],rejectAt:4}));

test('levels beyond the fast threshold use the ordinary agent',async()=>fixture(async f=>{
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false]);
},{fastLevels:1}));

test('truncated statements bypass fast code generation',async()=>fixture(async f=>{
  const call = f.client.call.bind(f.client);
  f.client.call = async(name,args)=>{
    const result = await call(name,args);
    if(name==='prepare_level')result.files.entries[0].pdf_preview = {text:'x'.repeat(20000)};
    return result;
  };
  await f.run();
  assert.ok(f.solverJobs.every(j=>!j.solverCodeOnly));
},{fastLevels:2}));

test('fast runner checks examples and hands a mismatch to the agent',async()=>fixture(async f=>{
  const call = f.client.call.bind(f.client);
  f.client.call = async(name,args)=>{
    const result = await call(name,args);
    if(name==='prepare_level')result.files.entries.push(
      {artifact_id:'example-in',filename:'in_0-example.txt',bytes:10},
      {artifact_id:'example-out',filename:'out_0-example.txt',bytes:10});
    return result;
  };
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true,false]);
  assert.match(f.solverJobs[1].prompt,/example mismatch/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
},{fastLevels:2}));

test('nonunique examples keep the fast path and provide accepted source to the next level',async()=>fixture(async f=>{
  const call=f.client.call.bind(f.client);
  f.client.call=async(name,args)=>{
    const result=await call(name,args);
    if(name==='prepare_level')result.files.entries.push(
      {artifact_id:'example-in',filename:'in_0-example.txt',bytes:10},
      {artifact_id:'example-out',filename:'out_0-example.txt',bytes:10});
    return result;
  };
  assert.match(await f.run(),/Accepted 4 new outputs/);
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,true]);
  assert.match(f.solverJobs[1].prompt,/previousLevel.*source.*#include/);
  assert.equal(f.calls.filter(c=>c.name==='submit_solution').length,4);
},{fastLevels:2,outputMode:'constructive'}));

test('constructive outputs rejected by the platform still fall back before sending later inputs',async()=>fixture(async f=>{
  await f.run();
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true]);
  assert.match(f.solverJobs[1].prompt,/isCorrect/);
  assert.deepEqual(f.calls.filter(c=>c.name==='submit_solution').slice(0,3).map(c=>c.args.file_id),['1-small','1-small','2-large']);
},{fastLevels:2,outputMode:'constructive',rejectFirst:true}));

test('light failure resumes correction after restart then returns to light',async()=>fixture(async f=>{
  const solve = async (solverJob, signal, emit) => {
    if (!solverJob.solverCodeOnly) throw new Error('Interrupted agent');
    return f.solve(solverJob, signal, emit);
  };
  await assert.rejects(runCccAuto(job,f.cwd,f.client,solve,f.controller.signal,event=>f.events.push(event)),/Interrupted agent/);
  const key=createHash('sha256').update('session:training-example').digest('hex').slice(0,24);
  const state=JSON.parse(await readFile(path.join(f.cwd,'.ai-router/ccc-auto',key,'state.json'),'utf8'));
  assert.equal(state.fastFailed,true);
  await f.run({taskId:'continued'});
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true,false]);
},{defaultFastLevels:true,badCode:true}));

test('light rejection stays in agent mode after restart without resubmitting accepted inputs',async()=>fixture(async f=>{
  const solve = async (solverJob, signal, emit) => {
    if (!solverJob.solverCodeOnly) throw new Error('Interrupted correction');
    return f.solve(solverJob, signal, emit);
  };
  await assert.rejects(runCccAuto(job,f.cwd,f.client,solve,f.controller.signal,event=>f.events.push(event)),/Interrupted correction/);
  await f.run({taskId:'continued'});
  assert.deepEqual(f.solverJobs.map(j=>Boolean(j.solverCodeOnly)),[true,false,true]);
  assert.deepEqual(f.calls.filter(c=>c.name==='submit_solution').map(c=>[c.args.level,c.args.file_id]),
    [[1,'1-small'],[1,'2-large'],[1,'2-large'],[2,'1-small'],[2,'2-large']]);
},{defaultFastLevels:true,rejectAt:2}));

for (const winner of ['medium', 'high']) test(`20s starts medium and high Fast; ${winner} wins and next light inherits its code and context`, async t => fixture(async f => {
  let lightStarted, backupsStarted;
  const lightReady = new Promise(resolve => { lightStarted = resolve; });
  const backupsReady = new Promise(resolve => { backupsStarted = resolve; });
  const agents = [], stopped = [];
  let nextLight;
  const solve = async (solverJob, signal, emit) => {
    if (solverJob.solverCodeOnly && solverJob.prompt.startsWith('Solve CCC level 2')) {
      nextLight = solverJob;
      return f.solve(solverJob, signal, emit);
    }
    emit({type:'usage',data:{inputTokens:10,outputTokens:5,totalTokens:15}});
    emit({type:'checkpoint',data:{threadId:`thread-${solverJob.reasoning}`}});
    if (solverJob.solverCodeOnly) {
      const dir = path.join(f.cwd,'.ai-router/ccc-auto',createHash('sha256').update('session:training-example').digest('hex').slice(0,24),'level-1',`run-${createHash('sha256').update('task').digest('hex').slice(0,16)}-0-original`);
      await writeFile(path.join(dir,'solution.cpp'),'// current light code');
      lightStarted();
    } else {
      agents.push(solverJob);
      if (agents.length === 2) backupsStarted();
      await backupsReady;
      assert.equal(signal.aborted, false);
      assert.equal(solverJob.model,'gpt-6.1-sol');
      assert.equal(solverJob.fast,true);
      assert.match(solverJob.prompt,/Current light source.*current light code/);
      if (solverJob.reasoning === winner) {
        const output = solverJob.prompt.match(/directly write (\S+) with JSON/)[1];
        const ids = JSON.parse(solverJob.prompt.match(/pending ID: (\[[^\n]+\])/)[1]);
        await writeFile(path.join(path.dirname(output),'solution.cpp'),`// ${winner} winner\n#include <iostream>\nint main(){std::cout << 42;}`);
        await writeFile(output,JSON.stringify({answers:ids.map(file_id=>({file_id,solution:'42\n'}))}));
        return 'Solver ready.';
      }
    }
    return new Promise((resolve,reject) => {
      signal.addEventListener('abort',()=>{stopped.push(solverJob.reasoning);reject(signal.reason);},{once:true});
      if(signal.aborted)reject(signal.reason);
    });
  };
  t.mock.timers.enable({apis:['setTimeout']});
  const pending = runCccAuto(job,f.cwd,f.client,solve,f.controller.signal,event=>f.events.push(event));
  await lightReady;
  t.mock.timers.tick(19_999);
  assert.equal(agents.length,0);
  t.mock.timers.tick(1);
  t.mock.timers.reset();
  assert.match(await pending,/Accepted 4 new outputs/);
  assert.deepEqual(agents.map(j=>j.reasoning).sort(),['high','medium']);
  assert.equal(new Set(agents.map(j=>j.taskId)).size,2);
  assert.equal(new Set(agents.map(j=>j.jobId)).size,2);
  assert.deepEqual(stopped.sort(),['low',winner === 'medium' ? 'high' : 'medium'].sort());
  assert.match(nextLight.prompt,new RegExp(`previousLevel.*${winner} winner`));
  assert.match(nextLight.prompt,/previousLevel.*Full statement.*previews/);
  assert.equal(nextLight.reasoning,'low');
  assert.equal(nextLight.fast,true);
  assert.equal(f.events.filter(e=>e.type==='usage').at(-1).data.totalTokens,60);
  const key=createHash('sha256').update('session:training-example').digest('hex').slice(0,24);
  const state=JSON.parse(await readFile(path.join(f.cwd,'.ai-router/ccc-auto',key,'state.json'),'utf8'));
  assert.equal(state.solverThread.threadId,`thread-${winner}`);
  assert.equal(state.fastFailed,undefined);
},{fastLevels:2}));

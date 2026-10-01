import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withOptimization, runRecipe } from '../dist/ccc-execution.js';

test('quick scripts complete without invoking optimization', async () => {
  let optimized = false;
  assert.equal(await withOptimization(async()=>42, async()=>{optimized=true;return 43;},new AbortController().signal,()=>{},20),42);
  await delay(30);
  assert.equal(optimized,false);
});
test('original keeps running during optimization and stops only after a validated replacement finishes', async () => {
  let originalSignal, originalStopped = false, slow = false;
  const result = await withOptimization(async signal=>{
    originalSignal=signal;
    try {await delay(300,undefined,{signal});return 'original';}finally{originalStopped=signal.aborted;}
  },async signal=>{
    assert.equal(originalSignal.aborted,false);
    await delay(30,undefined,{signal});
    assert.equal(originalSignal.aborted,false);
    return 'optimized';
  },new AbortController().signal,()=>{slow=true;},20);
  assert.equal(result,'optimized'); assert.equal(slow,true); assert.equal(originalStopped,true);
});
test('failed optimization leaves the original computation alive', async () => {
  let originalSignal;
  const result=await withOptimization(async signal=>{originalSignal=signal;await delay(50,undefined,{signal});return 'original';},async()=>{assert.equal(originalSignal.aborted,false);throw new Error('Bad optimization');},new AbortController().signal,()=>{},10);
  assert.equal(result,'original');
});
test('when the original finishes first, the in-progress optimizer is canceled', async () => {
  let optimizedStopped=false;
  const result=await withOptimization(async signal=>{await delay(50,undefined,{signal});return 'original';},async signal=>{try{await delay(500,undefined,{signal});return 'optimized';}finally{optimizedStopped=signal.aborted;}},new AbortController().signal,()=>{},10);
  assert.equal(result,'original');assert.equal(optimizedStopped,true);
});
test('user stop cancels both computation and optimizer', async () => {
  const controller=new AbortController();let stopped=0;
  const work=async signal=>{try{await delay(500,undefined,{signal});return 1;}finally{stopped++;}};
  const pending=withOptimization(work,work,controller.signal,()=>{},10);
  await delay(30);controller.abort();await assert.rejects(pending,/abort/i);assert.equal(stopped,2);
});
test('real solver remains alive at the default ten-second threshold while a faster candidate is prepared', {timeout:20000}, async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'ccc-script-'));
  try {
    await writeFile(path.join(root,'solver.json'),JSON.stringify({runtime:'node',script:'solution.cjs'}));
    await writeFile(path.join(root,'solution.cjs'),`const fs=require('node:fs');fs.writeFileSync('pid',String(process.pid));setTimeout(()=>{fs.writeFileSync(process.argv[3],'original');},60000);`);
    const start=Date.now();let observedAlive=false;
    const answer=await withOptimization(async signal=>{
      await runRecipe(root,path.join(root,'task.json'),path.join(root,'answer.txt'),signal);
      return await readFile(path.join(root,'answer.txt'),'utf8');
    },async signal=>{
      assert.ok(Date.now()-start>=9900);
      const pid=Number(await readFile(path.join(root,'pid'),'utf8'));
      process.kill(pid,0);observedAlive=true;
      await delay(20,undefined,{signal});return 'optimized';
    },new AbortController().signal,()=>{});
    assert.equal(answer,'optimized');assert.equal(observedAlive,true);
  }finally{await rm(root,{recursive:true,force:true});}
});

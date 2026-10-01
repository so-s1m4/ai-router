import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withOptimization, withExecutionLimit, runRecipe } from '../dist/ccc-execution.js';

test('quick scripts complete without invoking optimization', async () => {
  let optimized = false;
  assert.equal(await withOptimization(async()=>42, async()=>{optimized=true;return 43;},new AbortController().signal,()=>{},20),42);
  await delay(30);
  assert.equal(optimized,false);
});
test('optimization starts only after the timed-out original has stopped', async () => {
  let originalStopped = false, slow = false;
  const result = await withOptimization(async signal => {
    try { await delay(500, undefined, { signal }); return 'original'; }
    finally { originalStopped = signal.aborted; }
  }, async () => {
    assert.equal(originalStopped, true);
    return 'optimized';
  }, new AbortController().signal, () => { slow = true; }, 20);
  assert.equal(result, 'optimized'); assert.equal(slow, true);
});
test('execution failures do not launch an optimizer', async () => {
  let optimized = false;
  await assert.rejects(withOptimization(async () => { throw new Error('Broken solver'); }, async () => { optimized = true; }, new AbortController().signal, () => {}, 20), /Broken solver/);
  assert.equal(optimized, false);
});
test('user stop does not launch optimization', async () => {
  const controller = new AbortController(); let optimized = false;
  const pending = withOptimization(signal => delay(500, undefined, { signal }), async () => { optimized = true; }, controller.signal, () => {}, 100);
  await delay(10); controller.abort();
  await assert.rejects(pending, /abort/i); assert.equal(optimized, false);
});
test('user stop cancels optimization after an execution timeout', async () => {
  const controller = new AbortController(); let optimizedStopped = false;
  const pending = withOptimization(signal => delay(500, undefined, { signal }), async signal => {
    controller.abort();
    try { await delay(500, undefined, { signal }); }
    finally { optimizedStopped = signal.aborted; }
  }, controller.signal, () => {}, 10);
  await assert.rejects(pending, /abort/i); assert.equal(optimizedStopped, true);
});
test('a successful result returns immediately without waiting for cancellation', async () => {
  let optimized = false;
  assert.equal(await withOptimization(async () => 'done', async () => { optimized = true; await delay(500); }, new AbortController().signal, () => {}, 100), 'done');
  assert.equal(optimized, false);
});
test('real solver is stopped before optimization starts', { timeout: 5000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccc-script-'));
  try {
    await writeFile(path.join(root, 'solver.json'), JSON.stringify({ runtime: 'node', script: 'solution.cjs' }));
    await writeFile(path.join(root, 'solution.cjs'), `const fs=require('node:fs');fs.writeFileSync('pid',String(process.pid));setTimeout(()=>{},60000);`);
    const answer = await withOptimization(async signal => {
      await runRecipe(root, path.join(root, 'task.json'), path.join(root, 'answer.txt'), signal);
      return 'original';
    }, async () => {
      const pid = Number(await readFile(path.join(root, 'pid'), 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      return 'optimized';
    }, new AbortController().signal, () => {}, 500);
    assert.equal(answer, 'optimized');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('optimized execution also has a limit', async () => {
  await assert.rejects(withExecutionLimit(signal => delay(500, undefined, { signal }), new AbortController().signal, 10), /exceeded/);
});

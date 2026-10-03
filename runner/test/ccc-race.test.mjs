import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { raceLight, lightHeadStartMs } from '../dist/ccc-race.js';

const stopped = signal => delay(60_000, undefined, { signal });
test('light has a 20 second head start and quick answers launch no backups', async () => {
  assert.equal(lightHeadStartMs, 20_000);
  let started = 0;
  assert.equal(await raceLight(async () => 'light', [async () => ++started], new AbortController().signal, () => {}, 10), 'light');
  await delay(20);
  assert.equal(started, 0);
});
test('both backups run together without stopping light; winner cancels and joins losers', async () => {
  const started = [], canceled = [];
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const result = await raceLight(async signal => {
    started.push('light');
    try { return await stopped(signal); } finally { canceled.push('light'); }
  }, [async signal => {
    started.push('medium');
    await ready;
    assert.equal(signal.aborted, false);
    return 'medium';
  }, async signal => {
    started.push('high');
    release();
    try { return await stopped(signal); } finally { canceled.push('high'); }
  }], new AbortController().signal, () => { assert.deepEqual(canceled, []); }, 10);
  assert.equal(result, 'medium');
  assert.deepEqual(started, ['light', 'medium', 'high']);
  assert.deepEqual(canceled.sort(), ['high', 'light']);
});
test('light can still win after backups start and candidate errors do not win', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  assert.equal(await raceLight(async () => { await ready; return 'light'; }, [async () => { throw new Error('bad candidate'); }, async signal => { release(); return stopped(signal); }], new AbortController().signal, () => {}, 10), 'light');
});
test('failure before deadline falls back immediately without delayed backups', async () => {
  let backups = 0;
  await assert.rejects(raceLight(async () => { throw new Error('bad light'); }, [async () => ++backups], new AbortController().signal, () => {}, 10), /bad light/);
  await delay(20);
  assert.equal(backups, 0);
});
test('all failed candidates reject; user cancellation stops every candidate', async () => {
  await assert.rejects(raceLight(async () => { await delay(30); throw new Error('bad light'); }, [async () => { throw new Error('bad backup'); }], new AbortController().signal, () => {}, 5), /bad backup/);
  const controller = new AbortController();
  let canceled = 0;
  const run = async signal => { try { await stopped(signal); } finally { canceled++; } };
  const pending = raceLight(run, [run, run], controller.signal, () => {}, 5);
  await delay(20);
  controller.abort(new Error('user stop'));
  await assert.rejects(pending, /user stop/);
  assert.equal(canceled, 3);
});

test('background agent starts with light; light can win and cancels background', async () => {
  const started = [], canceled = [];
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const result = await raceLight(async () => { started.push('light'); await ready; return 'light'; },
    [async () => { throw new Error('must not start'); }], new AbortController().signal, () => {}, 100,
    { background: async signal => { started.push('background'); release(); try { return await stopped(signal); } finally { canceled.push('background'); } } });
  assert.equal(result, 'light');
  assert.deepEqual(started, ['light', 'background']);
  assert.deepEqual(canceled, ['background']);
});

test('light error immediately starts recovery agent while delayed backups remain scheduled', async () => {
  const started = [], canceled = [];
  const result = await raceLight(async () => { started.push('light'); throw new Error('bad light'); },
    [async () => { started.push('medium'); return 'medium'; }, async signal => { started.push('high'); return stopped(signal); }],
    new AbortController().signal, () => {}, 10, { recoverLight: async (error, signal) => {
      assert.match(error.message, /bad light/);
      started.push('background');
      try { return await stopped(signal); } finally { canceled.push('background'); }
    } });
  assert.equal(result, 'medium');
  assert.deepEqual(started, ['light', 'background', 'medium', 'high']);
  assert.deepEqual(canceled, ['background']);
});

test('failed light and background wait for delayed medium and high', async () => {
  const fail = async () => { throw new Error('bad candidate'); };
  const started = [];
  assert.equal(await raceLight(fail, [async () => { started.push('medium'); return 'medium'; }, async () => { started.push('high'); return 'high'; }],
    new AbortController().signal, () => {}, 10, { background: fail }), 'medium');
  assert.deepEqual(started, ['medium', 'high']);
});

test('platform rejection keeps existing candidates alive and submissions are serialized', async () => {
  const controller = new AbortController();
  let releaseCheck, releaseBackground;
  const checking = new Promise(resolve => { releaseCheck = resolve; });
  const backgroundReady = new Promise(resolve => { releaseBackground = resolve; });
  const checks = [], signals = [];
  let active = 0;
  const pending = raceLight(async signal => { signals.push(signal); return 'light'; },
    [async signal => { signals.push(signal); return 'medium'; }, async signal => { signals.push(signal); return stopped(signal); }],
    controller.signal, () => releaseBackground(), 5, {
      background: async signal => { signals.push(signal); await backgroundReady; return 'background'; },
      accept: async value => {
        assert.equal(active++, 0);
        checks.push(value);
        if (value === 'light') {
          await checking;
          assert.ok(signals.every(signal => !signal.aborted));
        }
        active--;
        return value === 'background';
      },
    });
  await backgroundReady;
  assert.ok(signals.every(signal => !signal.aborted));
  releaseCheck();
  assert.equal(await pending, 'background');
  assert.equal(checks[0], 'light');
  assert.ok(signals.every(signal => signal.aborted));
});

test('uncertain platform validation stops the race without submitting queued candidates', async () => {
  const checks = [];
  await assert.rejects(raceLight(async () => 'light', [], new AbortController().signal, () => {}, 10, {
    background: async () => 'background',
    accept: async value => { checks.push(value); throw new Error('unknown submission'); },
  }), /unknown submission/);
  assert.deepEqual(checks, ['light']);
});

test('a loser ignoring cancellation cannot hold the next level indefinitely', async () => {
  let cleanup;
  const started = Date.now();
  assert.equal(await raceLight(async () => 'winner', [], new AbortController().signal, () => {}, 1000, {
    background: async () => new Promise(() => {}),
    onCleanup: (elapsedMs, drained) => { cleanup = {elapsedMs, drained}; },
  }), 'winner');
  assert.equal(cleanup.drained, false);
  assert.ok(Date.now() - started < 1000);
});

test('scheduled candidates use individual delays and keep racing after one provider fails',async()=>{
  const {raceScheduled}=await import('../dist/ccc-race.js');
  const start=Date.now(), starts=[], errors=[];
  const result=await raceScheduled([
    {delayMs:0,run:async()=>{starts.push(['light',Date.now()-start]);throw Object.assign(new Error('HTTP 429'),{code:'rate_limit'});}},
    {delayMs:25,run:async()=>{starts.push(['medium',Date.now()-start]);return 'medium';}},
    {delayMs:500,run:async()=>{starts.push(['high',Date.now()-start]);return 'high';}},
  ],new AbortController().signal,async value=>value==='medium',(index,error)=>errors.push(index));
  assert.equal(result,'medium');assert.deepEqual(starts.map(s=>s[0]),['light','medium']);assert.ok(starts[1][1]>=20);assert.deepEqual(errors,[0]);
});
test('scheduled race cancels delayed starts on user cancellation',async()=>{
  const {raceScheduled}=await import('../dist/ccc-race.js');const controller=new AbortController();let called=false;
  const result=raceScheduled([{delayMs:1000,run:async()=>{called=true;return 1;}}],controller.signal,async()=>true);
  controller.abort(new Error('Stop'));await assert.rejects(result,/Stop/);assert.equal(called,false);
});

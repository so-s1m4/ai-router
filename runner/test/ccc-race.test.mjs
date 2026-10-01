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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isCccPreparation, prepareCcc, takeWarmCcc, warmRuntimes } from '../dist/ccc-warmup.js';
import { defaultCccAutoSettings } from '../dist/ccc-settings.js';

const makeJob = () => {
  const accountId = randomUUID(), cccAuto = defaultCccAutoSettings();
  for (const rule of cccAuto.levels) for (const candidate of rule.candidates) candidate.accountId = accountId;
  return { sessionId: randomUUID(), accountId, provider: 'codex', cccAuto, prompt: 'Прогрей всё', mode: 'task' };
};

test('preparation ignores links in history and preserves contest URL/slug requests', () => {
  assert.equal(isCccPreparation('Прогрей всё'), true);
  assert.equal(isCccPreparation('warmup'), true);
  assert.equal(isCccPreparation('History: https://codingcontest.org/contests/old/game\nCurrent user request:\nПодготовь API'), true);
  assert.equal(isCccPreparation('https://codingcontest.org/contests/new/game'), false);
  assert.equal(isCccPreparation('contest-slug'), false);
  assert.equal(isCccPreparation('https://wrong.example/'), false);
});

test('warmup probes each model once, retains MCP, isolates chats and invalidates settings', async () => {
  const job = makeJob(), signal = new AbortController().signal;
  let connects = 0, ready = 0, closes = 0, probes = 0, runtimes = 0;
  const events = [];
  const options = { connect: async () => {
    connects++;
    return { ready: async () => { ready++; }, call: async () => 'ok', close: async () => { closes++; } };
  }, runtimes: async () => { runtimes++; } };
  const solve = async (probe, signal, emit) => {
    probes++;
    assert.equal(probe.workflow, 'standard');
    assert.equal(probe.solverCodeOnly, true);
    emit({ type: 'usage', data: { input_tokens: 2, output_tokens: 3 } });
    return '{"source":"ready","outputMode":"exact"}';
  };
  await prepareCcc(job, '/tmp', solve, signal, e => events.push(e), options);
  await prepareCcc(job, '/tmp', solve, signal, e => events.push(e), options);
  assert.equal(probes, 1); assert.equal(connects, 1); assert.equal(ready, 1); assert.equal(runtimes, 1);
  assert.equal(closes, 0);
  assert.equal(events.at(-1).data.totalTokens, 5);
  assert.equal(events.at(-1).data.cccUsage[0].accountId, job.accountId);
  assert.equal(await takeWarmCcc({ ...job, sessionId: randomUUID() }, signal), undefined);
  const changed = structuredClone(job); changed.cccAuto.extraInstructions = 'changed';
  assert.equal(await takeWarmCcc(changed, signal), undefined);
  const client = await takeWarmCcc({ ...job, accountId: randomUUID() }, signal);
  assert.equal(await client.call('game_info', {}), 'ok');
  await client.close();
  assert.equal(closes, 1);
  assert.equal(await takeWarmCcc(job, signal), undefined);
});

test('failed runtime/model checks never cache readiness and close MCP', async () => {
  for (const failure of ['runtime', 'model']) {
    const job = makeJob(), signal = new AbortController().signal;
    let closed = false;
    await assert.rejects(prepareCcc(job, '/tmp', async () => {
      if (failure === 'model') throw new Error('API failed');
      return '{"source":"ready"}';
    }, signal, () => {}, {
      connect: async () => ({ ready: async () => {}, close: async () => { closed = true; } }),
      runtimes: async () => { if (failure === 'runtime') throw new Error('compiler failed'); },
    }));
    assert.equal(closed, true);
    assert.equal(await takeWarmCcc(job, signal), undefined);
  }
});

test('cancellation closes MCP and stops probes before readiness', async () => {
  const job = makeJob(), controller = new AbortController();
  let closed = false;
  await assert.rejects(prepareCcc(job, '/tmp', async () => {
    controller.abort(new Error('canceled'));
    return '{"source":"ready"}';
  }, controller.signal, () => {}, {
    connect: async () => ({ ready: async () => {}, close: async () => { closed = true; } }),
    runtimes: async () => {},
  }), /canceled/);
  assert.equal(closed, true);
  assert.equal(await takeWarmCcc(job, new AbortController().signal), undefined);
});

test('real C++17 compilation and Python/Node execution warm successfully', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ccc-warmup-'));
  try { await warmRuntimes(cwd, new AbortController().signal); }
  finally { await rm(cwd, { recursive: true, force: true }); }
});

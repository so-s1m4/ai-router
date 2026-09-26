import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('checkpoint keeps the original request and latest partial output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-checkpoint-'));
  try {
    const { CheckpointWriter } = await import('../dist/checkpoint.js');
    const taskId = '11111111-1111-4111-8111-111111111111';
    const writer = new CheckpointWriter(root, taskId, {
      taskId, jobId: '22222222-2222-4222-8222-222222222222',
      accountId: '33333333-3333-4333-8333-333333333333', provider: 'codex',
      sessionId: '44444444-4444-4444-8444-444444444444', model: 'default', prompt: 'Fix the project'
    });
    writer.update({ partialText: 'Changed file A' });
    writer.update({ status: 'handoff_pending', handoffReason: 'quota' });
    await writer.flush();
    const data = JSON.parse(await readFile(writer.file, 'utf8'));
    const handoff = await readFile(writer.handoffFile, 'utf8');
    assert.equal(data.prompt, 'Fix the project');
    assert.equal(data.partialText, 'Changed file A');
    assert.equal(data.status, 'handoff_pending');
    assert.match(handoff, /Changed file A/);
    assert.match(handoff, /Fix the project/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Codex App Server reuses a thread and handles completion sent with the turn response', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-appserver-'));
  const fake = path.join(root, 'fake-codex');
  await writeFile(fake, `#!/usr/bin/env node
let buffer = '', turns = 0;
process.stdin.on('data', chunk => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    let message; try { message = JSON.parse(line); } catch { continue; }
    const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
    if (message.method === 'initialize') send({ id: message.id, result: {} });
    if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thr_test' } } });
    if (message.method === 'thread/resume') send({ id: message.id, result: { thread: { id: 'thr_test' } } });
    if (message.method === 'turn/start') {
      turns++;
      const turnId = 'turn_' + turns;
      send({ id: message.id, result: { turn: { id: turnId } } });
      send({ method: 'item/agentMessage/delta', params: { threadId: 'thr_test', turnId, delta: 'answer ' + turns } });
      send({ method: 'turn/completed', params: { threadId: 'thr_test', turn: { id: turnId, status: 'completed' } } });
    }
  }
});
`);
  await chmod(fake, 0o700);
  const prior = process.env.CODEX_BIN;
  process.env.CODEX_BIN = fake;
  process.env.APP_SERVER_REQUEST_TIMEOUT_SECONDS = '3';
  process.env.CLI_TIMEOUT_SECONDS = '3';
  try {
    const { runCodexAppServer, closeCodexAppServers } = await import('../dist/app-server.js');
    const home = path.join(root, 'home'), cwd = path.join(root, 'workspace');
    await mkdir(home, { recursive: true }); await mkdir(cwd, { recursive: true });
    const job = { jobId: 'a', taskId: 'task-one', accountId: 'account-one', provider: 'codex', sessionId: 'session-one', prompt: 'test', model: 'default', mode: 'chat' };
    const events = [];
    try {
      const first = await runCodexAppServer(job, home, cwd, new AbortController().signal, event => events.push(event));
      const second = await runCodexAppServer(job, home, cwd, new AbortController().signal, event => events.push(event), first.threadId);
      assert.equal(first.threadId, 'thr_test');
      assert.equal(first.text, 'answer 1');
      assert.equal(second.text, 'answer 2');
      assert.equal(events.filter(event => event.type === 'checkpoint').length, 2);
    } finally { closeCodexAppServers(); }
  } finally {
    if (prior === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = prior;
    await rm(root, { recursive: true, force: true });
  }
});

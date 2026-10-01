import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('cancellation interrupts active turns and turns still starting', { timeout: 15000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-cancel-'));
  const fake = path.join(root, 'codex');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
let buffer = '';
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
process.stdin.on('data', chunk => { buffer += chunk; let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
    if (message.method === 'initialize') send({ id: message.id, result: {} });
    if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: 'thread' } } });
    if (message.method === 'turn/start') {
      fs.writeFileSync(process.env.HOME + '/starting', 'yes');
      setTimeout(() => send({ id: message.id, result: { turn: { id: 'turn' } } }), 150);
    }
    if (message.method === 'turn/interrupt') {
      fs.writeFileSync(process.env.HOME + '/interrupted', JSON.stringify(message.params));
      send({ id: message.id, result: {} });
    }
  }
});
`);
  await chmod(fake, 0o700);
  process.env.CODEX_BIN = fake;
  process.env.APP_SERVER_REQUEST_TIMEOUT_SECONDS = '2';
  const { runCodexAppServer, closeCodexAppServers, steerCodexJob } = await import('../dist/app-server.js');
  async function waitForFile(file) {
    for (let i = 0; i < 200; i++) {
      try { return await readFile(file, 'utf8'); } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    throw new Error('Missing ' + file);
  }
  try {
    for (const phase of ['starting', 'active']) {
      const home = path.join(root, phase), cwd = path.join(home, 'workspace');
      await mkdir(cwd, { recursive: true });
      const controller = new AbortController();
      let ready;
      const available = new Promise(resolve => ready = resolve);
      const result = runCodexAppServer({ jobId: phase, taskId: phase, sessionId: 'session', accountId: 'account',
        provider: 'codex', mode: 'task', model: 'default', prompt: 'Work' }, home, cwd, controller.signal,
        event => { if (event.data?.steeringAvailable) ready(); });
      const stopped = assert.rejects(result, error => error.code === 'canceled');
      if (phase === 'starting') await waitForFile(path.join(home, 'starting'));
      else await available;
      controller.abort();
      await stopped;
      assert.deepEqual(JSON.parse(await waitForFile(path.join(home, 'interrupted'))), { threadId: 'thread', turnId: 'turn' });
      await assert.rejects(steerCodexJob(phase, 'Continue'), /Steering/);
    }
  } finally { closeCodexAppServers(); await rm(root, { recursive: true, force: true }); }
});

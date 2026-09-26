import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('Antigravity approves headless tools only for task runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agy-task-mode-'));
  try {
    const cli = path.join(root, 'fake-agy');
    const capture = path.join(root, 'args.json');
    await writeFile(cli, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.ARGV_CAPTURE, JSON.stringify({args:process.argv.slice(2),nodeEnv:process.env.NODE_ENV||null}));
setTimeout(() => process.stdout.write(JSON.stringify({event:'result',result:{response:'ok',status:'SUCCESS'}})+'\\n'), Number(process.env.FAKE_DELAY_MS||0));
`, { mode: 0o700 });
    process.env.RUNNER_DATA_DIR = root;
    process.env.AGY_BIN = cli;
    process.env.ARGV_CAPTURE = capture;
    process.env.MOCK_MODE = 'false';
    process.env.NODE_ENV = 'production';
    const { execute } = await import('../dist/cli.js');
    const job = { jobId:'job', taskId:'task', accountId:'account', provider:'antigravity', sessionId:'session', prompt:'hello', model:'default', mode:'task' };

    assert.equal(await execute(job, new AbortController().signal, () => {}), 'ok');
    const taskRun = JSON.parse(await readFile(capture, 'utf8'));
    const taskArgs = taskRun.args;
    assert.ok(taskArgs.includes('--dangerously-skip-permissions'));
    assert.equal(taskArgs[taskArgs.indexOf('--mode') + 1], 'accept-edits');
    assert.equal(taskRun.nodeEnv, null);

    assert.equal(await execute({ ...job, mode:'chat' }, new AbortController().signal, () => {}), 'ok');
    const chatArgs = JSON.parse(await readFile(capture, 'utf8')).args;
    assert.ok(!chatArgs.includes('--dangerously-skip-permissions'));
    assert.equal(chatArgs[chatArgs.indexOf('--mode') + 1], 'plan');

    process.env.FAKE_DELAY_MS = '400';
    process.env.CLI_TIMEOUT_SECONDS = '0.1';
    process.env.CLI_TASK_TIMEOUT_SECONDS = '3';
    assert.equal(await execute(job, new AbortController().signal, () => {}), 'ok');
    await assert.rejects(execute({ ...job, mode:'chat' }, new AbortController().signal, () => {}), { code:'timeout' });
  } finally {
    for (const key of ['RUNNER_DATA_DIR','AGY_BIN','ARGV_CAPTURE','MOCK_MODE','NODE_ENV','FAKE_DELAY_MS','CLI_TIMEOUT_SECONDS','CLI_TASK_TIMEOUT_SECONDS']) delete process.env[key];
    await rm(root, { recursive:true, force:true });
  }
});

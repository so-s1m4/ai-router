import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('warm execution skips login subprocesses and reuses the account process', { timeout: 10000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-fast-'));
  const fake = path.join(root, 'codex');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.RUNNER_DATA_DIR + '/calls', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] !== 'app-server') process.exit(42);
let buffer = '', turns = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
process.stdin.on('data', chunk => {
 buffer += chunk; let index;
 while ((index = buffer.indexOf('\\n')) >= 0) {
  const message = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
  fs.appendFileSync(process.env.RUNNER_DATA_DIR + '/requests', message.method + '\\n');
  if (message.method === 'thread/resume') send({id:message.id,result:{thread:{id:'thread'}}});
  if (message.method === 'initialize') send({id:message.id,result:{}});
  if (message.method === 'thread/start') send({id:message.id,result:{thread:{id:'thread'}}});
  if (message.method === 'turn/start') {
   fs.appendFileSync(process.env.RUNNER_DATA_DIR + '/turns', JSON.stringify(message.params) + '\\n');
   const turnId = 'turn-' + ++turns;
   send({id:message.id,result:{turn:{id:turnId}}});
   send({method:'item/agentMessage/delta',params:{threadId:'thread',turnId,delta:'Done'}});
   send({method:'turn/completed',params:{threadId:'thread',turn:{id:turnId,status:'completed'}}});
  }
 }
});
`);
  await chmod(fake, 0o700);
  process.env.CODEX_BIN = fake;
  process.env.RUNNER_DATA_DIR = root;
  process.env.CODEX_APP_SERVER_MODE = 'true';
  const { execute } = await import('../dist/cli.js');
  const { closeCodexAppServers, prewarmCodexAppServer } = await import('../dist/app-server.js');
  try {
    const home = path.join(root, 'accounts/account/home');
    await mkdir(home, { recursive: true });
    await Promise.all([prewarmCodexAppServer(home), prewarmCodexAppServer(home)]);
    // A warm turn must not reread the synchronization marker.
    const marker = path.join(home, '.global-mcp-codex.json');
    await writeFile(marker, 'invalid-json');
    for (const id of ['one', 'two', 'two']) {
      const job = { jobId:id, taskId:id, accountId:'account', sessionId:'session', provider:'codex',
        mode:'task', model:'gpt-6.1-sol', prompt:'Work', fast:true, reasoning:'medium' };
      assert.equal(await execute(job, new AbortController().signal, () => {}), 'Done');
      assert.equal(job.prompt, 'Work');
    }
    const calls = (await readFile(path.join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'app-server');
    const turns = (await readFile(path.join(root, 'turns'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(turns.length, 3);
    assert.ok(turns.every(turn => turn.model === 'gpt-6.1-sol' && turn.effort === 'medium' && turn.serviceTierForTurn === 'fast'));
    assert.ok(turns.every(turn => turn.input[0].text.includes('Batch independent tool calls')));
    const requests = (await readFile(path.join(root, 'requests'), 'utf8')).trim().split('\n');
    assert.equal(requests.filter(method => method === 'thread/start').length, 2);
    assert.equal(requests.filter(method => method === 'thread/resume').length, 0);
    // A global update must invalidate the cache, even from another process.
    const globalFile = path.join(root, 'global-mcp/.gemini/config/mcp_config.json');
    await mkdir(path.dirname(globalFile), { recursive: true });
    await writeFile(globalFile, '{"mcpServers":{}}');
    await assert.rejects(prewarmCodexAppServer(home), SyntaxError);
    await writeFile(marker, '{}');
    await prewarmCodexAppServer(home);
    // Local settings still cause a process replacement on the next turn.
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await writeFile(path.join(home, '.codex/config.toml'), 'model = "gpt-6.1-sol"\n');
    await prewarmCodexAppServer(home);
    const updatedCalls = (await readFile(path.join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(updatedCalls.length, 2);
  } finally { closeCodexAppServers(); await rm(root, { recursive:true, force:true }); }
});

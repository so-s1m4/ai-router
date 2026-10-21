import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('codex exec explicitly enables Fast and overrides the account tier on each request', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'router-codex-fast-'));
  const saved = Object.fromEntries(['RUNNER_DATA_DIR', 'CODEX_BIN', 'CODEX_APP_SERVER_MODE'].map(key => [key, process.env[key]]));
  try {
    const fake = path.join(root, 'codex');
    await writeFile(fake, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'login') process.exit(0);
if (args[0] !== 'exec' || !args.some((arg, i) => arg === '--enable' && args[i + 1] === 'fast_mode')) process.exit(1);
const tier = args.find(arg => arg.startsWith('service_tier='));
process.stdout.write(JSON.stringify({type: 'item.completed', item: {type: 'agent_message', text: tier}}) + '\\n');
`, { mode: 0o700 });
    process.env.RUNNER_DATA_DIR = root;
    process.env.CODEX_BIN = fake;
    process.env.CODEX_APP_SERVER_MODE = 'false';
    const home = path.join(root, 'accounts', 'account', 'home', '.codex');
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'config.toml'), 'service_tier = "fast"\n[features]\nfast_mode = false\n');
    const { execute } = await import('../dist/cli.js');
    const job = { jobId: 'job', taskId: 'task', accountId: 'account', sessionId: 'session', provider: 'codex', prompt: 'test', model: 'default', mode: 'chat' };
    for (const fast of [true, false, undefined]) {
      const result = await execute({ ...job, fast }, new AbortController().signal, () => {});
      assert.equal(result, fast ? 'service_tier="fast"' : 'service_tier="default"');
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

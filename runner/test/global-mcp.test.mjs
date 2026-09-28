import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('global MCP reaches existing and new accounts, redacts secrets and removes entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'global-mcp-'));
  process.env.RUNNER_DATA_DIR = root;
  const { addMcp, listMcp, removeMcp, syncGlobalMcp } = await import('../dist/manager-mcp.js');
  try {
    const homes = [path.join(root, 'first'), path.join(root, 'new')];
    const configFile = home => path.join(home, '.gemini/config/mcp_config.json');
    await mkdir(path.dirname(configFile(homes[0])), { recursive: true });
    await writeFile(configFile(homes[0]), JSON.stringify({ mcpServers: { local: { command: 'local' } } }));
    await addMcp({ name: 'browser', command: 'playwright-mcp', env: { TOKEN: 'secret' } });
    assert.equal(JSON.stringify(await listMcp()).includes('secret'), false);
    for (const home of homes) {
      await Promise.all([syncGlobalMcp(home, 'antigravity'), syncGlobalMcp(home, 'antigravity')]);
      assert.equal(JSON.parse(await readFile(configFile(home))).mcpServers.browser.env.TOKEN, 'secret');
    }
    await removeMcp({ name: 'browser' });
    for (const home of homes) {
      await syncGlobalMcp(home, 'antigravity');
      assert.equal(JSON.parse(await readFile(configFile(home))).mcpServers.browser, undefined);
    }
    assert.equal(JSON.parse(await readFile(configFile(homes[0]))).mcpServers.local.command, 'local');
    await assert.rejects(addMcp({ name: 'bad', url: 'http://example.com' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

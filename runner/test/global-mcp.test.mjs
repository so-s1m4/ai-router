import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('global MCP reaches existing and new accounts, redacts secrets and removes entries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'global-mcp-'));
  process.env.RUNNER_DATA_DIR = root;
  const { addMcp, listMcp, removeMcp, syncGlobalMcp, updateMcpHeaders } = await import('../dist/manager-mcp.js');
  try {
    const homes = [path.join(root, 'first'), path.join(root, 'new')];
    const configFile = home => path.join(home, '.gemini/config/mcp_config.json');
    await mkdir(path.dirname(configFile(homes[0])), { recursive: true });
    await writeFile(configFile(homes[0]), JSON.stringify({ mcpServers: { local: { command: 'local' } } }));
    await addMcp({ name: 'browser', command: 'playwright-mcp', env: { TOKEN: 'secret' } });
    assert.equal(JSON.stringify(await listMcp()).includes('secret'), false);
    for (const [index, content] of ['', ' \n '].entries()) {
      const home = path.join(root, `empty-${index}`);
      const file = configFile(home);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
      if (index === 1) await writeFile(path.join(home, '.global-mcp-antigravity.json'), JSON.stringify({ browser: { command: 'playwright-mcp', args: [], env: { TOKEN: 'secret' } } }));
      await syncGlobalMcp(home, 'antigravity');
      assert.equal(JSON.parse(await readFile(file, 'utf8')).mcpServers.browser.env.TOKEN, 'secret');
    }
    for (const home of homes) {
      await Promise.all([syncGlobalMcp(home, 'antigravity'), syncGlobalMcp(home, 'antigravity')]);
      assert.equal(JSON.parse(await readFile(configFile(home))).mcpServers.browser.env.TOKEN, 'secret');
    }
    await addMcp({ name: 'remote', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret', 'X-API-Key': 'test-key' } });
    const remote = (await listMcp()).find(item => item.name === 'remote');
    assert.deepEqual(remote.headerNames, ['Authorization', 'X-API-Key']);
    assert.equal(JSON.stringify(remote).includes('secret'), false);
    await syncGlobalMcp(homes[0], 'antigravity');
    assert.equal(JSON.parse(await readFile(configFile(homes[0]))).mcpServers.remote.headers.Authorization, 'Bearer secret');
    for (const headers of [{ 'Bad Name': 'x' }, { Good: 'x\r\nInjected: true' }, { Token: 'a', token: 'b' }]) {
      await assert.rejects(addMcp({ name: 'invalid', url: 'https://example.com', headers }));
    }
    await assert.rejects(addMcp({ name: 'invalid', command: 'echo', headers: { Token: 'x' } }));
    await updateMcpHeaders({ name: 'remote', headers: { authorization: 'Bearer updated', 'X-New': 'new' }, removeHeaders: ['X-API-Key'] });
    await syncGlobalMcp(homes[0], 'antigravity');
    let saved = JSON.parse(await readFile(configFile(homes[0]))).mcpServers.remote;
    assert.equal(saved.serverUrl, 'https://example.com/mcp');
    assert.deepEqual(saved.headers, { authorization: 'Bearer updated', 'X-New': 'new' });
    await updateMcpHeaders({ name: 'remote', headers: { 'X-New': 'changed' } });
    await syncGlobalMcp(homes[0], 'antigravity');
    saved = JSON.parse(await readFile(configFile(homes[0]))).mcpServers.remote;
    assert.equal(saved.headers.authorization, 'Bearer updated');
    assert.equal(saved.headers['X-New'], 'changed');
    assert.equal(JSON.stringify(await listMcp()).includes('Bearer updated'), false);
    await assert.rejects(updateMcpHeaders({ name: 'remote', headers: { Good: 'bad\r\nInjected: yes' } }));
    await assert.rejects(updateMcpHeaders({ name: 'missing', headers: {} }));
    await assert.rejects(updateMcpHeaders({ name: 'browser', headers: { Token: 'x' } }));
    await updateMcpHeaders({ name: 'remote', removeHeaders: ['Authorization', 'X-New'] });
    await syncGlobalMcp(homes[0], 'antigravity');
    assert.deepEqual(JSON.parse(await readFile(configFile(homes[0]))).mcpServers.remote.headers, {});
    await removeMcp({ name: 'browser' });
    for (const home of homes) {
      await syncGlobalMcp(home, 'antigravity');
      assert.equal(JSON.parse(await readFile(configFile(home))).mcpServers.browser, undefined);
    }
    assert.equal(JSON.parse(await readFile(configFile(homes[0]))).mcpServers.local.command, 'local');
    await assert.rejects(addMcp({ name: 'bad', url: 'http://example.com' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

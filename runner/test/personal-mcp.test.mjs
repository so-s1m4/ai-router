import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { personalMcpOverrides } from '../dist/personal-mcp.js';

test('personal MCP overrides are scoped to the task and disable owner MCP for shared access', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'personal-mcp-'));
  try {
    await mkdir(path.join(home, '.codex'));
    const file = path.join(home, '.codex/config.toml');
    const original = '[mcp_servers.owner]\nurl="https://owner.example/mcp"\n';
    await writeFile(file, original);
    const server = {name:'friend',url:'https://friend.example/mcp',headers:{Authorization:'Bearer friend-secret'}};
    const friend = await personalMcpOverrides(home, {sharedExecution:true,personalMcp:[server]});
    assert.equal(friend['mcp_servers.owner.enabled'], false);
    assert.deepEqual(friend['mcp_servers.personal_friend'], {url:server.url,http_headers:server.headers,enabled:true});
    assert.deepEqual(await personalMcpOverrides(home, {}), {});
    assert.equal(await readFile(file, 'utf8'), original);
    const other = await personalMcpOverrides(home, {sharedExecution:true});
    assert.equal(other['mcp_servers.personal_friend'], undefined);
    assert.equal((await personalMcpOverrides(home, {solverOnly:true,personalMcp:[server]}))['mcp_servers.personal_friend'].enabled, false);
  } finally { await rm(home, {recursive:true,force:true}); }
});

test('a personal server disables the same runner server even on an owned account', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'personal-mcp-priority-'));
  try {
    await mkdir(path.join(home, '.codex'));
    const file = path.join(home, '.codex/config.toml');
    const original = '[mcp_servers.ccc]\nurl="https://owner.example/mcp"\n[mcp_servers.browser]\ncommand="browser-mcp"\n';
    await writeFile(file, original);
    const personal = {name:'ccc',url:'https://friend.example/mcp',headers:{Authorization:'Bearer friend-secret'}};
    const overrides = await personalMcpOverrides(home, {personalMcp:[personal]});
    assert.equal(overrides['mcp_servers.ccc.enabled'], false);
    assert.equal(overrides['mcp_servers.browser.enabled'], undefined);
    assert.deepEqual(overrides['mcp_servers.personal_ccc'], {url:personal.url,http_headers:personal.headers,enabled:true});
    assert.deepEqual(await personalMcpOverrides(home, {}), {});
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { await rm(home, {recursive:true,force:true}); }
});

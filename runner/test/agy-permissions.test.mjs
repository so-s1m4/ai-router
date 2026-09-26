import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensureAgyTaskPermissions, taskCommandRules } from '../dist/agy-permissions.js';

test('headless task permissions preserve account settings and user rules', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agy-permissions-'));
  try {
    const file = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({
      trustedWorkspaces: ['/workspace'],
      permissions: { allow: ['command(custom)'], deny: ['command(rm -rf)'] },
    }));

    await ensureAgyTaskPermissions(home);
    await ensureAgyTaskPermissions(home);
    const settings = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(settings.trustedWorkspaces, ['/workspace']);
    assert.deepEqual(settings.permissions.deny, ['command(rm -rf)']);
    assert.equal(settings.enableTerminalSandbox, false);
    assert.deepEqual(settings.permissions.allow, ['command(custom)', ...taskCommandRules]);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

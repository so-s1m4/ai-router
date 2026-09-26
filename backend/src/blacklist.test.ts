import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('model blacklist is empty by default and can be updated per user', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-blacklist-'));
  process.env.DATA_DIR = dir;
  try {
    const { getUserModelBlacklist, setUserModelBlacklist } = await import('./store.js');
    const user1 = 'test-user-1';
    const user2 = 'test-user-2';

    // 1. By default, blacklist is empty for any user
    const initialList = await getUserModelBlacklist(user1);
    assert.deepEqual(initialList, []);

    // 2. User 1 blacklists some models
    const saved1 = await setUserModelBlacklist(user1, ['gemini-3.8-flash', 'gpt-5']);
    assert.deepEqual(saved1.sort(), ['gemini-3.8-flash', 'gpt-5'].sort());

    const retrieved1 = await getUserModelBlacklist(user1);
    assert.deepEqual(retrieved1.sort(), ['gemini-3.8-flash', 'gpt-5'].sort());

    // 3. User 2 still has empty blacklist (user isolation)
    const retrieved2 = await getUserModelBlacklist(user2);
    assert.deepEqual(retrieved2, []);

    // 4. User 2 updates their own blacklist
    await setUserModelBlacklist(user2, ['o3']);
    assert.deepEqual(await getUserModelBlacklist(user2), ['o3']);
    assert.deepEqual(await getUserModelBlacklist(user1), saved1);

    // 5. User 1 re-enables a model (removes from blacklist)
    const updated1 = await setUserModelBlacklist(user1, ['gpt-5']);
    assert.deepEqual(await getUserModelBlacklist(user1), ['gpt-5']);

    // 6. Deduplication and invalid entries handling
    const clean = await setUserModelBlacklist(user1, ['gpt-4o', 'gpt-4o', '', '   ', 'o1']);
    assert.deepEqual(clean.sort(), ['gpt-4o', 'o1'].sort());
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

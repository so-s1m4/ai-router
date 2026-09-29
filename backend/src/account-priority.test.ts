import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { orderAccountsByPriority } from './account-priority.js';

test('higher priority accounts are tried first and equal priorities rotate', () => {
  const accounts = [
    { id: 'low', priority: 0 as const },
    { id: 'high-a', priority: 2 as const },
    { id: 'normal' },
    { id: 'high-b', priority: 2 as const }
  ];
  assert.deepEqual(orderAccountsByPriority(accounts, 0).map(a => a.id), ['high-a', 'high-b', 'normal', 'low']);
  assert.deepEqual(orderAccountsByPriority(accounts, 1).map(a => a.id), ['high-b', 'high-a', 'normal', 'low']);
});

test('account priority is saved without changing other accounts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-priority-'));
  process.env.DATA_DIR = dir;
  try {
    const { addAccount, deleteAccount, listAccounts, setAccountPriority } = await import('./store.js');
    const userId = 'priority-test-user';
    const first = await addAccount(userId, 'codex', 'First', 'runner-1');
    const second = await addAccount(userId, 'codex', 'Second', 'runner-1');
    assert.equal(first.priority, undefined);
    assert.equal((await setAccountPriority(userId, first.id, 2))?.priority, 2);
    assert.equal(await setAccountPriority(userId, 'missing-account', 0), null);
    const saved = await listAccounts(userId);
    assert.equal(saved.find(a => a.id === first.id)?.priority, 2);
    assert.equal(saved.find(a => a.id === second.id)?.priority, undefined);
    assert.equal((await deleteAccount(userId, first.id))?.id, first.id);
    assert.equal(await deleteAccount(userId, first.id), null);
    assert.deepEqual((await listAccounts(userId)).map(a => a.id), [second.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

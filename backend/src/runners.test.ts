import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('runner deletion checks ownership and invalidates device and manager credentials', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-delete-runner-'));
  process.env.DATA_DIR = dir;
  try {
    const { createPairing, enroll, createManagerPairing, enrollManager, verifyManager,
      verifyRunner, listRunners, deleteRunner, revokeRunner, setConnected, setManagerConnected, setMacConnected } = await import('./runners.js');
    const { addAccount, listAccounts } = await import('./store.js');
    const first = await enroll((await createPairing('user', 'first')).code);
    const second = await enroll((await createPairing('user', 'second')).code);
    const manager = await enrollManager((await createManagerPairing('user', first.id)).code);
    const pendingPairing = await createManagerPairing('user', first.id);
    const account = await addAccount('user', 'codex', 'account', first.id);
    let disconnected = 0;
    const socket = () => ({ connected: true, on() {}, disconnect() { disconnected++; } }) as any;
    setConnected(first.id, socket());
    setManagerConnected(first.id, socket());
    await setMacConnected(first.id, socket());
    assert.equal(await deleteRunner('other-user', first.id), false);
    assert.ok(await verifyRunner(first.id, first.secret));
    assert.equal(disconnected, 0);
    assert.equal(await deleteRunner('user', first.id), true);
    assert.equal(disconnected, 3);
    assert.equal(await verifyRunner(first.id, first.secret), null);
    assert.equal(await verifyManager(first.id, manager.secret), null);
    await assert.rejects(enrollManager(pendingPairing.code));
    assert.deepEqual((await listRunners('user')).map(r => r.id), [second.id]);
    assert.deepEqual(await listAccounts('user'), [account]);
    assert.equal(await deleteRunner('user', first.id), false);
    assert.equal(await revokeRunner('user', second.id), true);
    assert.equal(await deleteRunner('user', second.id), true);
    assert.deepEqual(await listRunners('user'), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

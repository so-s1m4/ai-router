import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('manager and worker use separate credentials for the same runner', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-manager-pairing-'));
  process.env.DATA_DIR = dir;
  try {
    const { createPairing, enroll, createManagerPairing, enrollManager, verifyManager, verifyRunner, listRunners } = await import('./runners.js');
    const pairing = await createPairing('user-1', 'test-runner');
    const runner = await enroll(pairing.code);
    const managerPairing = await createManagerPairing('user-1', runner.id);
    const manager = await enrollManager(managerPairing.code);
    assert.equal(manager.id, runner.id);
    assert.ok(await verifyRunner(runner.id, runner.secret));
    assert.ok(await verifyManager(runner.id, manager.secret));
    assert.equal(await verifyManager(runner.id, runner.secret), null);
    assert.equal(await verifyRunner(runner.id, manager.secret), null);
    const listed = await listRunners('user-1');
    assert.equal('secretHash' in listed[0], false);
    assert.equal('managerSecretHash' in listed[0], false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

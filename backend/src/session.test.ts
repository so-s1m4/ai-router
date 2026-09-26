import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('session can be created and updated with projectId', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ai-router-session-'));
  process.env.DATA_DIR = dir;
  try {
    const { createSession, getSession, saveSession } = await import('./store.js');
    const user = 'test-user-session';

    const session = await createSession(user);
    assert.ok(session.id);
    assert.equal(session.projectId, undefined);

    const fetched = await getSession(user, session.id);
    assert.ok(fetched);
    assert.equal(fetched.id, session.id);

    const testProjectId = '00000000-0000-0000-0000-000000000001';
    fetched.projectId = testProjectId;
    fetched.title = 'Updated Title';
    await saveSession(user, fetched);

    const afterUpdate = await getSession(user, session.id);
    assert.ok(afterUpdate);
    assert.equal(afterUpdate.projectId, testProjectId);
    assert.equal(afterUpdate.title, 'Updated Title');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
